import type { Span } from "../ast/span.js";
import type {
  CommKind,
  ProjectedProgram,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  ReceiveExpression,
} from "../ir/projected.js";
import { TOP_SCOPE } from "./tags.js";

/** Scope key for communication tags (spec §11.5): top-level or function name. */
export type CommScopeId = string;

export interface CommConsistencyError {
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

class CommConsistencyChecker {
  private readonly participants: Set<string>;
  private readonly byParticipant = new Map<string, ProjectedProgram>();
  private readonly errors: CommConsistencyError[] = [];

  private readonly sends: SendRecord[] = [];
  private readonly receives: ReceiveRecord[] = [];
  private readonly broadcasts: BroadcastRecord[] = [];
  /** `scope:tag` -> comm kind (spec §11.5). */
  private readonly tagCommByScope = new Map<string, CommKind>();

  constructor(programs: readonly ProjectedProgram[]) {
    this.participants = new Set(programs.map((p) => p.participant));
    for (const program of programs) {
      this.byParticipant.set(program.participant, program);
    }
    for (const program of programs) {
      this.collectFromProgram(program);
    }
  }

  check(): CommConsistencyResult {
    this.validateTagKinds();
    this.validateDirectPairs();
    this.validateBroadcasts();
    this.validateInvalidPatterns();
    return {
      ok: this.errors.length === 0,
      errors: this.errors,
    };
  }

  private collectFromProgram(program: ProjectedProgram): void {
    this.walkStatements(program.participant, TOP_SCOPE, program.body);
    for (const fn of program.functions) {
      this.walkStatements(program.participant, fn.name, fn.body.statements);
    }
  }

  private walkStatements(
    participant: string,
    scope: CommScopeId,
    statements: readonly ProjectedStatement[],
  ): void {
    for (const stmt of statements) {
      this.walkStatement(participant, scope, stmt);
    }
  }

  private walkStatement(
    participant: string,
    scope: CommScopeId,
    stmt: ProjectedStatement,
  ): void {
    switch (stmt.kind) {
      case "SendStatement": {
        this.registerTag(scope, stmt.tag, stmt.comm, stmt.span);
        if (stmt.destinationParticipant === participant) {
          this.error(
            `send to self at ${participant} (tag ${stmt.tag}, scope ${scope})`,
            stmt.span,
          );
        }
        this.sends.push({
          scope,
          src: participant,
          dst: stmt.destinationParticipant,
          tag: stmt.tag,
          comm: stmt.comm,
          span: stmt.span,
        });
        break;
      }
      case "BroadcastStatement": {
        this.registerTag(scope, stmt.tag, stmt.comm, stmt.span);
        this.broadcasts.push({
          scope,
          sender: participant,
          tag: stmt.tag,
          comm: stmt.comm,
          span: stmt.span,
        });
        break;
      }
      case "LetStatement": {
        const recv = asReceive(stmt.initializer);
        if (recv !== undefined) {
          this.registerReceive(participant, scope, recv);
        }
        break;
      }
      case "AssignmentStatement": {
        const recv = asReceive(stmt.value);
        if (recv !== undefined) {
          this.registerReceive(participant, scope, recv);
        }
        break;
      }
      case "IfStatement":
        this.walkStatements(participant, scope, stmt.then.statements);
        if (stmt.else !== undefined) {
          this.walkStatements(participant, scope, stmt.else.statements);
        }
        break;
      case "WhileStatement":
        this.walkStatements(participant, scope, stmt.body.statements);
        break;
      case "ForStatement": {
        if (stmt.init?.kind === "ForLetInit") {
          const recv = asReceive(stmt.init.initializer);
          if (recv !== undefined) {
            this.registerReceive(participant, scope, recv);
          }
        } else if (stmt.init?.kind === "ForAssignmentInit") {
          const recv = asReceive(stmt.init.value);
          if (recv !== undefined) {
            this.registerReceive(participant, scope, recv);
          }
        }
        this.walkStatements(participant, scope, stmt.body.statements);
        break;
      }
      case "ReturnStatement":
        if (stmt.value !== undefined) {
          const recv = asReceive(stmt.value);
          if (recv !== undefined) {
            this.registerReceive(participant, scope, recv);
          }
        }
        break;
      case "ExpressionStatement":
        break;
      case "AbsentStatement":
        break;
    }
  }

  private registerReceive(
    participant: string,
    scope: CommScopeId,
    recv: ReceiveExpression,
  ): void {
    this.registerTag(scope, recv.tag, recv.comm, recv.span);
    if (recv.sourceParticipant === participant) {
      this.error(
        `receive from self at ${participant} (tag ${recv.tag}, scope ${scope})`,
        recv.span,
      );
    }
    if (!this.participants.has(recv.sourceParticipant)) {
      this.error(
        `receive from unknown participant '${recv.sourceParticipant}' at ${participant}`,
        recv.span,
      );
    }
    if (recv.sourceParticipant === "every") {
      this.error(
        `receive from @every source at ${participant} (tag ${recv.tag}, scope ${scope})`,
        recv.span,
      );
    }
    this.receives.push({
      scope,
      dst: participant,
      src: recv.sourceParticipant,
      tag: recv.tag,
      comm: recv.comm,
      span: recv.span,
    });
  }

  private registerTag(
    scope: CommScopeId,
    tag: string,
    comm: CommKind,
    span: Span,
  ): void {
    const key = tagKey(scope, tag);
    const existing = this.tagCommByScope.get(key);
    if (existing !== undefined && existing !== comm) {
      this.error(
        `tag '${tag}' in scope '${scope}' used for both ${existing} and ${comm} communication`,
        span,
      );
    }
    this.tagCommByScope.set(key, comm);
  }

  private validateTagKinds(): void {
    // Registered during collection; duplicate-kind errors already recorded.
  }

  private validateDirectPairs(): void {
    for (const send of this.sends) {
      const match = this.receives.find(
        (r) =>
          r.scope === send.scope &&
          r.src === send.src &&
          r.dst === send.dst &&
          r.tag === send.tag &&
          r.comm === send.comm,
      );
      if (match === undefined) {
        this.error(
          `missing receive${capitalize(send.comm)}("${send.src}", "${send.tag}") at ${send.dst} for send from ${send.src} (scope ${send.scope})`,
          send.span,
        );
      }
    }
    for (const recv of this.receives) {
      const broadcast = this.broadcasts.find(
        (b) =>
          b.scope === recv.scope &&
          b.sender === recv.src &&
          b.tag === recv.tag &&
          b.comm === recv.comm,
      );
      if (broadcast !== undefined) {
        continue;
      }
      const match = this.sends.find(
        (s) =>
          s.scope === recv.scope &&
          s.src === recv.src &&
          s.dst === recv.dst &&
          s.tag === recv.tag &&
          s.comm === recv.comm,
      );
      if (match === undefined) {
        this.error(
          `missing send${capitalize(recv.comm)}("${recv.dst}", "${recv.tag}", ...) at ${recv.src} for receive at ${recv.dst} (scope ${recv.scope})`,
          recv.span,
        );
      }
    }
  }

  private validateBroadcasts(): void {
    for (const b of this.broadcasts) {
      for (const participant of this.participants) {
        if (participant === b.sender) {
          if (!this.senderHasBroadcastLocalHandling(b)) {
            this.error(
              `broadcast sender ${b.sender} missing local let/assignment without receive for tag ${b.tag} (scope ${b.scope})`,
              b.span,
            );
          }
          continue;
        }
        const match = this.receives.find(
          (r) =>
            r.scope === b.scope &&
            r.dst === participant &&
            r.src === b.sender &&
            r.tag === b.tag &&
            r.comm === b.comm,
        );
        if (match === undefined) {
          this.error(
            `missing receive${capitalize(b.comm)}("${b.sender}", "${b.tag}") at ${participant} for broadcast from ${b.sender} (scope ${b.scope})`,
            b.span,
          );
        }
      }
    }
  }

  private senderHasBroadcastLocalHandling(b: BroadcastRecord): boolean {
    const program = this.byParticipant.get(b.sender);
    if (program === undefined) {
      return false;
    }
    return (
      this.scopeHasNonReceiveBinding(program, b.scope, TOP_SCOPE, program.body) ||
      program.functions.some((fn) =>
        fn.name === b.scope
          ? this.scopeHasNonReceiveBinding(program, b.scope, b.scope, fn.body.statements)
          : false,
      )
    );
  }

  private scopeHasNonReceiveBinding(
    program: ProjectedProgram,
    scope: CommScopeId,
    walkScope: CommScopeId,
    statements: readonly ProjectedStatement[],
  ): boolean {
    if (walkScope !== scope && scope !== TOP_SCOPE) {
      return false;
    }
    for (const stmt of statements) {
      if (stmt.kind === "LetStatement" && asReceive(stmt.initializer) === undefined) {
        return true;
      }
      if (
        stmt.kind === "AssignmentStatement" &&
        asReceive(stmt.value) === undefined
      ) {
        return true;
      }
      if (stmt.kind === "IfStatement") {
        if (
          this.scopeHasNonReceiveBinding(program, scope, walkScope, stmt.then.statements) ||
          (stmt.else !== undefined &&
            this.scopeHasNonReceiveBinding(program, scope, walkScope, stmt.else.statements))
        ) {
          return true;
        }
      }
      if (stmt.kind === "WhileStatement") {
        if (
          this.scopeHasNonReceiveBinding(
            program,
            scope,
            walkScope,
            stmt.body.statements,
          )
        ) {
          return true;
        }
      }
      if (stmt.kind === "ForStatement") {
        if (
          stmt.init?.kind === "ForLetInit" &&
          asReceive(stmt.init.initializer) === undefined
        ) {
          return true;
        }
        if (
          stmt.init?.kind === "ForAssignmentInit" &&
          asReceive(stmt.init.value) === undefined
        ) {
          return true;
        }
        if (
          this.scopeHasNonReceiveBinding(
            program,
            scope,
            walkScope,
            stmt.body.statements,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private validateInvalidPatterns(): void {
    for (const send of this.sends) {
      if (send.src === send.dst) {
        this.error(
          `direct communication with same source and destination '${send.src}' (tag ${send.tag})`,
          send.span,
        );
      }
    }
  }

  private error(message: string, span?: Span): void {
    this.errors.push({ message, span });
  }
}

interface SendRecord {
  readonly scope: CommScopeId;
  readonly src: string;
  readonly dst: string;
  readonly tag: string;
  readonly comm: CommKind;
  readonly span: Span;
}

interface ReceiveRecord {
  readonly scope: CommScopeId;
  readonly dst: string;
  readonly src: string;
  readonly tag: string;
  readonly comm: CommKind;
  readonly span: Span;
}

interface BroadcastRecord {
  readonly scope: CommScopeId;
  readonly sender: string;
  readonly tag: string;
  readonly comm: CommKind;
  readonly span: Span;
}

function tagKey(scope: CommScopeId, tag: string): string {
  return `${scope}\0${tag}`;
}

function asReceive(expr: ProjectedExpression): ReceiveExpression | undefined {
  return expr.kind === "ReceiveExpression" ? expr : undefined;
}

function capitalize(comm: CommKind): string {
  return comm.charAt(0).toUpperCase() + comm.slice(1);
}
