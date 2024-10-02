declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<string, string> {}
  }
}
export { }