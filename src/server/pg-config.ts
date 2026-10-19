export function postgresOptions(connectionString: string) {
  const url = new URL(connectionString);
  // Connection-string SSL parameters otherwise replace pg's explicit TLS verification settings.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_SSL_CA
        ? { ca: process.env.DATABASE_SSL_CA }
        : {}),
    },
  };
}
