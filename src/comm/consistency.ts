import type { Span } from "../ast/span.js";
import type {
  CommKind,
  ProjectedProgram,
  ProjectedStatement,
  ProjectedExpression,
  ProjectedForUpdate,
  ReceiveExpression,
  BroadcastStatement,
} from "../ir/projected.js";
import { childExpressions } from "../ir/traverse.js";
import type { SpecCited, SpecRefs } from "../spec/ref.js";
import { TOP_SCOPE } from "./tags.js";

/** Scope key for communication tags (spec §communication-tags): top-level or function name. */
export type CommScopeId = string;

export interface CommConsistencyError extends SpecCited {
  readonly message: string;
  readonly span?: Span;
}

export interface CommConsistencyResult {
  readonly ok: boolean;
  readonly errors: readonly CommConsistencyError[];
}

export function checkCommunicationConsistency(
  programs: readonly ProjectedProgram[],
): CommConsistencyResult {
  const checker = new CommConsistencyChecker(programs);
  return checker.check();
}

type CommRole = "send" | "receive" | "broadcast";

/**
 * One end of a communication, located by the control path it sits on.
 *
 * A tag identifies exactly one transfer in the source (spec §communication-tags), so the ends
 * of a single communication must agree on more than their existence: they must
 * sit at the same point in the control structure, which endpoint projection
 * replicates identically at every endpoint (spec §if-projection–§for-projection).
 */
interface Occurrence {
  readonly endpoint: string;
  readonly scope: CommScopeId;
  readonly tag: string;
  readonly comm: CommKind;
  readonly role: CommRole;
  /** Destination for `send`, source for `receive`, unused for `broadcast`. */
  readonly peer?: string;
  readonly path: ControlPath;
  readonly span: Span;
}

/**
 * Enclosing control statements, outermost first, keyed by source span so the
 * same choreographic statement yields the same segment at every endpoint.
 */
type ControlPath = readonly string[];

interface WalkContext {
  readonly endpoint: string;
  readonly scope: CommScopeId;
  readonly path: ControlPath;
}

class CommConsistencyChecker {
  private readonly endpoints: readonly string[];
  private readonly errors: CommConsistencyError[] = [];

  /** `scope\0tag` -> every end of that communication, across all endpoints. */
  private readonly sites = new Map<string, Occurrence[]>();

  constructor(programs: readonly ProjectedProgram[]) {
    this.endpoints = programs.map((p) => p.endpoint);
    for (const program of programs) {
      this.collectFromProgram(program);
    }
  }

  check(): CommConsistencyResult {
    for (const occurrences of this.sites.values()) {
      this.validateSite(occurrences);
    }
    return {
      ok: this.errors.length === 0,
      errors: this.errors,
    };
  }

  // --- collection ------------------------------------------------------

  private collectFromProgram(program: ProjectedProgram): void {
    this.walkStatements(
      { endpoint: program.endpoint, scope: TOP_SCOPE, path: [] },
      program.body,
    );
    for (const fn of program.functions) {
      this.walkStatements(
        { endpoint: program.endpoint, scope: fn.name, path: [] },
        fn.body.statements,
      );
    }
  }

  private walkStatements(
    ctx: WalkContext,
    statements: readonly ProjectedStatement[],
  ): void {
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i]!;
      if (stmt.kind === "BroadcastStatement") {
        this.checkBroadcastSenderBinding(ctx, stmt, statements[i + 1]);
      }
      this.walkStatement(ctx, stmt);
    }
  }

  private walkStatement(ctx: WalkContext, stmt: ProjectedStatement): void {
    switch (stmt.kind) {
      case "SendStatement": {
        this.record(ctx, {
          tag: stmt.tag,
          comm: stmt.comm,
          role: "send",
          peer: stmt.destinationEndpoint,
          span: stmt.span,
        });
        if (stmt.destinationEndpoint === ctx.endpoint) {
          this.error(
            `send to self at ${ctx.endpoint} (tag ${stmt.tag}, scope ${ctx.scope})`,
            stmt.span,
          );
        }
        if (!this.endpoints.includes(stmt.destinationEndpoint)) {
          this.error(
            `send to unknown endpoint '${stmt.destinationEndpoint}' at ${ctx.endpoint} (tag ${stmt.tag}, scope ${ctx.scope})`,
            stmt.span,
          );
        }
        this.walkExpression(ctx, stmt.value);
        break;
      }
      case "BroadcastStatement": {
        this.record(ctx, {
          tag: stmt.tag,
          comm: stmt.comm,
          role: "broadcast",
          span: stmt.span,
        });
        this.walkExpression(ctx, stmt.value);
        break;
      }
      case "LetStatement":
        this.walkExpression(ctx, stmt.initializer);
        break;
      case "AssignmentStatement":
        if (stmt.target.kind === "IndexAssignmentTarget") {
          this.walkExpression(ctx, stmt.target.index);
        }
        this.walkExpression(ctx, stmt.value);
        break;
      case "IfStatement": {
        this.walkExpression(ctx, stmt.condition);
        this.walkStatements(
          this.descend(ctx, `if@${stmt.span.start}>then`),
          stmt.then.statements,
        );
        if (stmt.else !== undefined) {
          this.walkStatements(
            this.descend(ctx, `if@${stmt.span.start}>else`),
            stmt.else.statements,
          );
        }
        break;
      }
      case "WhileStatement":
        this.walkExpression(ctx, stmt.condition);
        this.walkStatements(
          this.descend(ctx, `while@${stmt.span.start}`),
          stmt.body.statements,
        );
        break;
      case "ForStatement": {
        // The header runs outside the body, so it gets its own path segment.
        const header = this.descend(ctx, `for@${stmt.span.start}>header`);
        if (stmt.init?.kind === "ForLetInit") {
          this.walkExpression(header, stmt.init.initializer);
        } else if (stmt.init !== undefined) {
          this.walkForClause(header, stmt.init);
        }
        this.walkExpression(header, stmt.condition);
        if (stmt.update !== undefined) {
          this.walkForClause(header, stmt.update);
        }
        this.walkStatements(
          this.descend(ctx, `for@${stmt.span.start}>body`),
          stmt.body.statements,
        );
        break;
      }
      case "ReturnStatement":
        this.walkExpression(ctx, stmt.value);
        break;
      case "ExpressionStatement":
        this.walkExpression(ctx, stmt.expression);
        break;
    }
  }

  private walkForClause(ctx: WalkContext, clause: ProjectedForUpdate): void {
    if (clause.kind === "ForExpressionInit") {
      this.walkExpression(ctx, clause.expression);
      return;
    }
    if (clause.target.kind === "IndexAssignmentTarget") {
      this.walkExpression(ctx, clause.target.index);
    }
    this.walkExpression(ctx, clause.value);
  }

  /**
   * Finds receives anywhere in an expression, not just as the whole
   * initializer. Endpoint projection only ever produces them at the top level
   * (spec §transfer-projection); walking the whole tree keeps a stray nested receive from
   * going unmatched.
   *
   * The shape of the walk comes from {@link childExpressions}, which is
   * exhaustive over the IR — a node added there cannot be silently skipped
   * here. Statements are walked by hand below, because this pass needs things
   * a generic traversal cannot give it: the sibling that follows a broadcast,
   * and a separate control path per branch.
   */
  private walkExpression(
    ctx: WalkContext,
    expr: ProjectedExpression | undefined,
  ): void {
    if (expr === undefined) {
      return;
    }
    if (expr.kind === "ReceiveExpression") {
      this.registerReceive(ctx, expr);
      return;
    }
    for (const child of childExpressions(expr)) {
      this.walkExpression(ctx, child);
    }
  }

  private registerReceive(ctx: WalkContext, recv: ReceiveExpression): void {
    this.record(ctx, {
      tag: recv.tag,
      comm: recv.comm,
      role: "receive",
      peer: recv.sourceEndpoint,
      span: recv.span,
    });
    if (recv.sourceEndpoint === ctx.endpoint) {
      this.error(
        `receive from self at ${ctx.endpoint} (tag ${recv.tag}, scope ${ctx.scope})`,
        recv.span,
      );
    }
    if (recv.sourceEndpoint === "every") {
      this.error(
        `receive from @every source at ${ctx.endpoint} (tag ${recv.tag}, scope ${ctx.scope})`,
        recv.span,
      );
    } else if (!this.endpoints.includes(recv.sourceEndpoint)) {
      this.error(
        `receive from unknown endpoint '${recv.sourceEndpoint}' at ${ctx.endpoint}`,
        recv.span,
      );
    }
  }

  /**
   * The broadcasting endpoint keeps its own copy of the value instead of
   * receiving it, and projection emits that binding right after the broadcast
   * (spec §broadcast-communication, §transfer-projection).
   */
  private checkBroadcastSenderBinding(
    ctx: WalkContext,
    broadcast: BroadcastStatement,
    next: ProjectedStatement | undefined,
  ): void {
    const bound =
      next?.kind === "LetStatement"
        ? next.initializer
        : next?.kind === "AssignmentStatement"
          ? next.value
          : undefined;
    if (bound === undefined) {
      this.error(
        `broadcast sender ${ctx.endpoint} must bind its own copy of tag ${broadcast.tag} right after broadcasting (scope ${ctx.scope})`,
        broadcast.span,
      );
      return;
    }
    if (bound.kind === "ReceiveExpression") {
      this.error(
        `broadcast sender ${ctx.endpoint} receives its own broadcast for tag ${broadcast.tag} (scope ${ctx.scope})`,
        broadcast.span,
      );
    }
  }

  private descend(ctx: WalkContext, segment: string): WalkContext {
    return { ...ctx, path: [...ctx.path, segment] };
  }

  private record(
    ctx: WalkContext,
    part: Omit<Occurrence, "endpoint" | "scope" | "path">,
  ): void {
    const key = siteKey(ctx.scope, part.tag);
    const occurrence: Occurrence = {
      ...part,
      endpoint: ctx.endpoint,
      scope: ctx.scope,
      path: ctx.path,
    };
    const existing = this.sites.get(key);
    if (existing === undefined) {
      this.sites.set(key, [occurrence]);
    } else {
      existing.push(occurrence);
    }
  }

  // --- validation ------------------------------------------------------

  private validateSite(occurrences: readonly Occurrence[]): void {
    const first = occurrences[0]!;
    const { scope, tag } = first;

    this.validateCommKinds(occurrences);
    this.validateOnePerEndpoint(occurrences);
    this.validateSamePath(occurrences);

    const broadcasts = occurrences.filter((o) => o.role === "broadcast");
    const sends = occurrences.filter((o) => o.role === "send");
    const receives = occurrences.filter((o) => o.role === "receive");

    if (broadcasts.length > 0) {
      if (sends.length > 0) {
        this.error(
          `tag '${tag}' in scope '${scope}' is used for both broadcast and direct communication`,
          first.span,
        );
      }
      const broadcasters = [...new Set(broadcasts.map((b) => b.endpoint))];
      if (broadcasters.length > 1) {
        this.error(
          `tag '${tag}' in scope '${scope}' is broadcast by more than one endpoint: ${broadcasters.join(", ")}`,
          first.span,
        );
      }
      this.validateBroadcast(broadcasts[0]!, receives);
      return;
    }

    const senders = [...new Set(sends.map((s) => s.endpoint))];
    if (senders.length > 1) {
      this.error(
        `tag '${tag}' in scope '${scope}' is sent by more than one endpoint: ${senders.join(", ")}`,
        first.span,
      );
    }
    this.validateDirect(sends, receives);
  }

  private validateBroadcast(
    broadcast: Occurrence,
    receives: readonly Occurrence[],
  ): void {
    for (const endpoint of this.endpoints) {
      if (endpoint === broadcast.endpoint) {
        continue;
      }
      const match = receives.find(
        (r) =>
          r.endpoint === endpoint &&
          r.peer === broadcast.endpoint &&
          r.comm === broadcast.comm,
      );
      if (match === undefined) {
        this.error(
          `missing receive${capitalize(broadcast.comm)}("${broadcast.endpoint}", "${broadcast.tag}") at ${endpoint} for broadcast from ${broadcast.endpoint} (scope ${broadcast.scope})`,
          broadcast.span,
        );
      }
    }
    for (const recv of receives) {
      if (recv.peer !== broadcast.endpoint) {
        this.error(
          `receive${capitalize(recv.comm)}("${recv.peer}", "${recv.tag}") at ${recv.endpoint} names a source other than broadcaster ${broadcast.endpoint} (scope ${recv.scope})`,
          recv.span,
        );
      }
    }
  }

  private validateDirect(
    sends: readonly Occurrence[],
    receives: readonly Occurrence[],
  ): void {
    for (const send of sends) {
      const match = receives.find(
        (r) =>
          r.endpoint === send.peer &&
          r.peer === send.endpoint &&
          r.comm === send.comm,
      );
      if (match === undefined) {
        this.error(
          `missing receive${capitalize(send.comm)}("${send.endpoint}", "${send.tag}") at ${send.peer} for send from ${send.endpoint} (scope ${send.scope})`,
          send.span,
        );
      }
    }
    for (const recv of receives) {
      const match = sends.find(
        (s) =>
          s.endpoint === recv.peer &&
          s.peer === recv.endpoint &&
          s.comm === recv.comm,
      );
      if (match === undefined) {
        this.error(
          `missing send${capitalize(recv.comm)}("${recv.endpoint}", "${recv.tag}", ...) at ${recv.peer} for receive at ${recv.endpoint} (scope ${recv.scope})`,
          recv.span,
        );
      }
    }
  }

  private validateCommKinds(occurrences: readonly Occurrence[]): void {
    const first = occurrences[0]!;
    for (const occurrence of occurrences) {
      if (occurrence.comm !== first.comm) {
        this.error(
          `tag '${first.tag}' in scope '${first.scope}' used for both ${first.comm} and ${occurrence.comm} communication`,
          occurrence.span,
        );
        return;
      }
    }
  }

  /**
   * A tag names one transfer in one scope (spec §communication-tags), so each endpoint takes
   * part in it at most once. A second occurrence means projection duplicated a
   * communication, and set-based matching would happily pair the wrong ends.
   */
  private validateOnePerEndpoint(occurrences: readonly Occurrence[]): void {
    const seen = new Map<string, Occurrence>();
    for (const occurrence of occurrences) {
      const previous = seen.get(occurrence.endpoint);
      if (previous !== undefined) {
        this.error(
          `tag '${occurrence.tag}' in scope '${occurrence.scope}' is used more than once at ${occurrence.endpoint} (${previous.role} and ${occurrence.role}); each tag identifies exactly one transfer`,
          occurrence.span,
        );
        return;
      }
      seen.set(occurrence.endpoint, occurrence);
    }
  }

  /**
   * Both ends must sit on the same control path. Without this, a send in a
   * `then` branch pairs with a receive in the matching `else` branch and the
   * mismatch goes unreported.
   */
  private validateSamePath(occurrences: readonly Occurrence[]): void {
    const first = occurrences[0]!;
    for (const occurrence of occurrences) {
      if (!pathsEqual(occurrence.path, first.path)) {
        this.error(
          `tag '${first.tag}' in scope '${first.scope}' occurs on different control paths: ${first.role} at ${first.endpoint} in ${formatPath(first.path)}, ${occurrence.role} at ${occurrence.endpoint} in ${formatPath(occurrence.path)}`,
          occurrence.span,
        );
        return;
      }
    }
  }

  private error(message: string, span?: Span, spec: SpecRefs = []): void {
    this.errors.push({ message, span, spec });
  }
}

function siteKey(scope: CommScopeId, tag: string): string {
  return `${scope}\0${tag}`;
}

function pathsEqual(a: ControlPath, b: ControlPath): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

function formatPath(path: ControlPath): string {
  return path.length === 0 ? "<top level>" : path.join(" > ");
}

function capitalize(comm: CommKind): string {
  return comm.charAt(0).toUpperCase() + comm.slice(1);
}
