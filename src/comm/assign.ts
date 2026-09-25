import type {
  TypedProgram,
  TypedTopLevelItem,
  TypedFunctionDeclaration,
  TypedTopLevelStatement,
  TypedBlock,
  TypedStatement,
  TypedLetTransferStatement,
  TypedTransferStatement,
  TypedIfStatement,
  TypedWhileStatement,
  TypedForStatement,
} from "../ast/typed.js";
import { CommTagGenerator, TOP_SCOPE } from "./tags.js";

/**
 * Communication tag assignment (spec §communication-tags) — the stage between type checking
 * and endpoint projection.
 *
 * A tag names exactly one transfer in the choreography. Assigning it here, in
 * a single pass over the whole program *before* projection, is what makes the
 * two ends of a communication agree by construction: EPP replicates the one
 * tag to the sender and the receiver, so they cannot drift. Nothing downstream
 * ever has to reconcile two independently chosen names.
 *
 * This used to run inside the type checker, interleaved with checking. Numbers
 * then depended on the checker's traversal order, and any speculative re-walk
 * of a body — return type inference does exactly that — risked minting tags
 * that no statement would keep.
 *
 * Only `direct` and `broadcast` transfers get a tag; a `localCopy` sends
 * nothing (spec §transfer-typing), and EPP relies on the absence of a tag to mean exactly
 * that.
 */
export function assignCommTags(typed: TypedProgram): TypedProgram {
  const tags = new CommTagGenerator();
  return {
    ...typed,
    items: typed.items.map((item) => assignInItem(tags, item)),
  };
}

/**
 * The scope a tag is numbered within: the enclosing function, or the top level
 * (spec §communication-tags).
 *
 * The top-level scope name carries the compiler-reserved `__` prefix
 * (spec §function-names), so it cannot equal any function name and the two
 * series cannot collide.
 *
 * `comm/consistency.ts` re-derives this same rule from the *projected* IR, to
 * check after the fact what this pass decided. The two must agree; they are
 * kept in one directory so that a change to one is visible next to the other.
 */
function assignInItem(
  tags: CommTagGenerator,
  item: TypedTopLevelItem,
): TypedTopLevelItem {
  if ("decl" in item) {
    const fn: TypedFunctionDeclaration = item;
    return { ...fn, body: assignInBlock(tags, fn.decl.name, fn.body) };
  }
  const top: TypedTopLevelStatement = item;
  return {
    ...top,
    statement: assignInStatement(tags, TOP_SCOPE, top.statement),
  };
}

function assignInBlock(
  tags: CommTagGenerator,
  scope: string,
  block: TypedBlock,
): TypedBlock {
  return {
    ...block,
    statements: block.statements.map((stmt) =>
      assignInStatement(tags, scope, stmt),
    ),
  };
}

/**
 * Rebuilds only the spine down to the transfers.
 *
 * A transfer is a statement — there is no transfer expression — so no
 * expression subtree can hold a tag and none is walked. For the same reason a
 * `for` header is skipped: `ForInit` and `ForUpdate` are `let` and assignment
 * forms only, and the condition is an expression.
 *
 * `TypedStatement` carries no discriminant of its own, so it is narrowed by the
 * syntactic node it wraps, exactly as endpoint projection does.
 */
function assignInStatement(
  tags: CommTagGenerator,
  scope: string,
  stmt: TypedStatement,
): TypedStatement {
  switch (stmt.stmt.kind) {
    case "LetTransferStatement": {
      const transfer = stmt as TypedLetTransferStatement;
      return { ...transfer, commTag: tagFor(tags, scope, transfer) };
    }
    case "TransferStatement": {
      const transfer = stmt as TypedTransferStatement;
      return { ...transfer, commTag: tagFor(tags, scope, transfer) };
    }
    case "IfStatement": {
      const ifStmt = stmt as TypedIfStatement;
      return {
        ...ifStmt,
        then: assignInBlock(tags, scope, ifStmt.then),
        else:
          ifStmt.else === undefined
            ? undefined
            : assignInBlock(tags, scope, ifStmt.else),
      };
    }
    case "WhileStatement": {
      const whileStmt = stmt as TypedWhileStatement;
      return { ...whileStmt, body: assignInBlock(tags, scope, whileStmt.body) };
    }
    case "ForStatement": {
      const forStmt = stmt as TypedForStatement;
      return { ...forStmt, body: assignInBlock(tags, scope, forStmt.body) };
    }
    case "LetStatement":
    case "AssignmentStatement":
    case "ReturnStatement":
    case "ExpressionStatement":
      return stmt;
  }
}

function tagFor(
  tags: CommTagGenerator,
  scope: string,
  transfer: TypedLetTransferStatement | TypedTransferStatement,
): string | undefined {
  if (transfer.transferMode === "localCopy") {
    return undefined;
  }
  return tags.next(scope);
}
