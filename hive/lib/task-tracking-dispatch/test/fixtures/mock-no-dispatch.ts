// Mock adapter that exports the wrong shape — used to validate the
// "missing dispatch export" rejection path.

export function notDispatch() {
  return "this is not the function the dispatcher is looking for";
}
