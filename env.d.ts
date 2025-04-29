declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<string, string> {
      NODE_ENV: string;
      FIREBASE_TYPE: string;
      FIREBASE_PROJECT_ID: string;
      FIREBASE_PRIVATE_KEY_ID: string;
      FIREBASE_PRIVATE_KEY: string;
      FIREBASE_CLIENT_EMAIL: string;
      FIREBASE_CLIENT_ID: string;
      FIREBASE_AUTH_URI: string;
      FIREBASE_TOKEN_URI: string;
      FIREBASE_AUTH_PROVIDER_X509_CERT_URL: string;
      FIREBASE_CLIENT_X509_CERT_URL: string;
      FIREBASE_UNIVERSE_DOMAIN: string;
      API_KEY: string;
      GOOGLE_MAPS_API_KEY: string;
      FIRECRAWL_API_KEY: string;
      GITHUB_TOKEN_M: string;
      GITHUB_TOKEN_R: string;
      GITHUB_TOKEN_D: string;
      REPO_OWNER: string;
      REPO_NAME: string;
      GEMINI_API_KEY: string;
      OPENAI_API_KEY: string;
    }
  }
}
export { }
