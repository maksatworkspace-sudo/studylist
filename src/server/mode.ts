/** Demo/local mode: same condition the historical PGlite path used. */
export const localMode = () =>
  !process.env.DATABASE_URL &&
  process.env.NODE_ENV !== "production" &&
  !process.env.VERCEL;
