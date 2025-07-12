const error = <I, O>(
  e: I, 
  fn?: (error: I, ...args: any[]) => O, 
  ...opts: any[]
): I | O => {
  const isError = Error.isError(e);
  return isError 
    ? ( fn 
      ? fn(e, ...opts) 
      : e) 
    : e;
};

class CustomError extends Error {
  constructor() {
    super()
  }
}

(() => {
  // Test 1: Passing an Error object, no fn
  const err1 = new Error("Something went wrong");
  console.log("Test 1:", error(err1)); // Should print the error object

  // Test 2: Passing an Error object, with fn - explicitly type the call
  const fn = (err: Error) => `Handled: ${err.message}`;
  console.log("Test 2:", error<Error, string>(err1, fn)); // Explicitly specify the generic types

  // Test 3: Passing a non-error value
  const notError = "Just a string";
  console.log("Test 3:", error(notError)); // Should print "Just a string"

  // Test 4: Passing a non-error value with fn - each call should be independent
  console.log("Test 4:", error(notError)); // Should print "Just a string" (fn won't be called for non-errors)

  // Test 5: Passing an Error object with fn and extra opts
  const fnWithOpts = (err: Error, prefix: string) => `${prefix}: ${err.message}`;
  console.log("Test 5:", error<Error, string>(err1, fnWithOpts, "Oops"));
})();