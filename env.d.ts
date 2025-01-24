declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<string, string> {
      NODE_ENV: string;
    }
  }
}
export { }
