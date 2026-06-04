/**
 * Gradual ChoreoBS BlueScript runtime module (spec §18.8, §18.20).
 *
 * Emitted as a separate `index_runtime_<participant>.bs` file for each
 * participant when a program uses gradual features. `HERE` is specialized per
 * endpoint; everything else is shared.
 */

const SCALAR_BINARY: ReadonlyArray<readonly [string, string]> = [
  ["dynAdd", "+"],
  ["dynSub", "-"],
  ["dynMul", "*"],
  ["dynDiv", "/"],
  ["dynMod", "%"],
  ["dynAnd", "&&"],
  ["dynOr", "||"],
  ["dynLt", "<"],
  ["dynLe", "<="],
  ["dynGt", ">"],
  ["dynGe", ">="],
  ["dynEq", "==="],
  ["dynNeq", "!=="],
];

const SCALAR_REQUIRE: ReadonlyArray<readonly [string, string]> = [
  ["requireIntegerAt", "integer"],
  ["requireFloatAt", "float"],
  ["requireBooleanAt", "boolean"],
  ["requireStringAt", "string"],
];

const ARRAY_REQUIRE: ReadonlyArray<readonly [string, string]> = [
  ["requireIntegerArrayAt", "integer[]"],
  ["requireFloatArrayAt", "float[]"],
  ["requireBooleanArrayAt", "boolean[]"],
];

export function emitRuntimeModule(participant: string): string {
  const parts: string[] = [];
  parts.push(header(participant));
  parts.push(errorHelpers());
  parts.push(commHelpers());
  parts.push(packHelper());
  parts.push(scalarRequireHelpers());
  parts.push(arrayRequireHelpers());
  parts.push(conditionRequireHelper());
  parts.push(binaryHelpers());
  parts.push(unaryHelpers());
  parts.push(moveHelper());
  parts.push(arrayHelpers());
  return parts.join("\n") + "\n";
}

function header(participant: string): string {
  return `// Gradual ChoreoBS runtime (spec §18.20), specialized for ${participant}.
const EVERY: string = "every";
const HERE: string = ${JSON.stringify(participant)};

class DynValue {
  value: any;
  location: string;

  constructor(value: any, location: string) {
    this.value = value;
    this.location = location;
  }

  copyWrapper(): DynValue {
    return new DynValue(this.value, this.location);
  }
}
`;
}

function errorHelpers(): string {
  return `function DynamicLocationMismatch(): any {
  return "DynamicLocationMismatch";
}

function InvalidDynamicCommunication(): any {
  return "InvalidDynamicCommunication";
}

function InvalidDynamicArrayAccess(): any {
  return "InvalidDynamicArrayAccess";
}
`;
}

function commHelpers(): string {
  return `function sendAny(dst: string, tag: string, value: any): void {
  send(dst, tag, value);
}

function receiveAny(src: string, tag: string): any {
  return receive(src, tag);
}

function broadcastAny(tag: string, value: any): void {
  broadcast(tag, value);
}

function clonePayload(value: any): any {
  if (Array.isArray(value)) {
    return value.slice();
  }
  return value;
}
`;
}

function packHelper(): string {
  return `function packDynamic(value: any, location: string): DynValue {
  return new DynValue(value, location);
}
`;
}

function scalarRequireHelpers(): string {
  return SCALAR_REQUIRE.map(([name, ret]) => scalarRequire(name, ret)).join(
    "\n",
  );
}

function scalarRequire(name: string, ret: string): string {
  return `function ${name}(dynamic: DynValue, location: string): ${ret} {
  if (location === EVERY) {
    if (dynamic.location === EVERY) {
      return dynamic.value;
    } else {
      throw DynamicLocationMismatch();
    }
  } else {
    if (dynamic.location === EVERY) {
      return dynamic.value;
    } else if (dynamic.location === location) {
      return dynamic.value;
    } else {
      throw DynamicLocationMismatch();
    }
  }
}
`;
}

function arrayRequireHelpers(): string {
  return ARRAY_REQUIRE.map(([name, ret]) => arrayRequire(name, ret)).join("\n");
}

function arrayRequire(name: string, ret: string): string {
  return `function ${name}(dynamic: DynValue, location: string): ${ret} {
  if (dynamic.location === location) {
    return dynamic.value;
  } else {
    throw DynamicLocationMismatch();
  }
}
`;
}

function conditionRequireHelper(): string {
  return `function requireCondition(dynamic: DynValue): boolean {
  if (dynamic.location === EVERY) {
    return dynamic.value;
  } else {
    throw DynamicLocationMismatch();
  }
}
`;
}

function binaryHelpers(): string {
  return SCALAR_BINARY.map(([name, op]) => binaryHelper(name, op)).join("\n");
}

function binaryHelper(name: string, op: string): string {
  return `function ${name}(a: DynValue, b: DynValue): DynValue {
  if (a.location === EVERY && b.location === EVERY) {
    return new DynValue(a.value ${op} b.value, EVERY);
  } else if (a.location === EVERY) {
    if (b.location === HERE) return new DynValue(a.value ${op} b.value, b.location);
    else return new DynValue(null, b.location);
  } else if (b.location === EVERY) {
    if (a.location === HERE) return new DynValue(a.value ${op} b.value, a.location);
    else return new DynValue(null, a.location);
  } else {
    if (a.location === b.location) {
      if (a.location === HERE) return new DynValue(a.value ${op} b.value, a.location);
      else return new DynValue(null, a.location);
    } else {
      throw DynamicLocationMismatch();
    }
  }
}
`;
}

function unaryHelpers(): string {
  return `function dynNot(a: DynValue): DynValue {
  if (a.location === EVERY || a.location === HERE) {
    return new DynValue(!a.value, a.location);
  } else {
    return new DynValue(null, a.location);
  }
}

function dynNeg(a: DynValue): DynValue {
  if (a.location === EVERY || a.location === HERE) {
    return new DynValue(-a.value, a.location);
  } else {
    return new DynValue(null, a.location);
  }
}
`;
}

function moveHelper(): string {
  return `function dynMove(from: DynValue, tag: string, toLocation: string): DynValue {
  if (from.location === EVERY && toLocation === EVERY) {
    throw InvalidDynamicCommunication();
  } else if (from.location === EVERY) {
    if (toLocation === HERE)
      return new DynValue(clonePayload(from.value), toLocation);
    else
      return new DynValue(null, toLocation);
  } else if (toLocation === EVERY) {
    if (from.location === HERE) {
      broadcastAny(tag, from.value);
      return new DynValue(clonePayload(from.value), toLocation);
    } else {
      return new DynValue(receiveAny(from.location, tag), toLocation);
    }
  } else {
    if (from.location === toLocation) {
      throw InvalidDynamicCommunication();
    } else {
      if (from.location === HERE) {
        sendAny(toLocation, tag, from.value);
        return new DynValue(null, toLocation);
      } else if (toLocation === HERE) {
        return new DynValue(receiveAny(from.location, tag), toLocation);
      } else {
        return new DynValue(null, toLocation);
      }
    }
  }
}
`;
}

function arrayHelpers(): string {
  return `function dynArrayGet(arr: DynValue, index: DynValue): DynValue {
  if (arr.location === EVERY && index.location === EVERY) {
    return new DynValue(arr.value[index.value], EVERY);
  } else if (arr.location === EVERY) {
    throw InvalidDynamicArrayAccess();
  } else if (index.location === EVERY) {
    if (arr.location === HERE) return new DynValue(arr.value[index.value], arr.location);
    else return new DynValue(null, arr.location);
  } else {
    if (arr.location === index.location) {
      if (arr.location === HERE) return new DynValue(arr.value[index.value], arr.location);
      else return new DynValue(null, arr.location);
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
}

function dynArraySet(arr: DynValue, index: DynValue, item: DynValue): void {
  if (arr.location === EVERY) {
    if (index.location === EVERY && item.location === EVERY) {
      arr.value[index.value] = item.value;
    } else {
      throw InvalidDynamicArrayAccess();
    }
  } else {
    if (
      (index.location === EVERY || index.location === arr.location) &&
      (item.location === EVERY || item.location === arr.location)
    ) {
      if (arr.location === HERE) {
        arr.value[index.value] = item.value;
      }
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
}

function dynArrayPush(arr: DynValue, item: DynValue): void {
  if (arr.location === EVERY) {
    if (item.location === EVERY) {
      arr.value.push(item.value);
    } else {
      throw InvalidDynamicArrayAccess();
    }
  } else {
    if (item.location === EVERY || arr.location === item.location) {
      if (arr.location === HERE) {
        arr.value.push(item.value);
      }
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
}

function dynArrayLength(arr: DynValue): DynValue {
  if (arr.location === EVERY || arr.location === HERE) {
    return new DynValue(arr.value.length, arr.location);
  } else {
    return new DynValue(null, arr.location);
  }
}
`;
}
