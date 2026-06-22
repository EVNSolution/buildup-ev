// TODO: DBMS 확정 후 연결
export const config = {
  port: Number(process.env['PORT'] ?? 3001),
  dbUrl: process.env['DATABASE_URL'] ?? '',
  jwtSecret: process.env['JWT_SECRET'] ?? '',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
};
