// pm2 keeps the API running on the server: it restarts it within seconds if it ever stops, and starts it
// again after the server reboots (`pm2 startup` + `pm2 save`). Secrets stay in backend/.env on the server.
module.exports = {
  apps: [
    {
      name: 'service-hub-api',
      cwd: `${__dirname}/../backend`,
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        // Only Caddy on the same machine talks to the API.
        HOST: '127.0.0.1',
      },
      max_memory_restart: '400M',
      restart_delay: 3000,
      time: true,
    },
  ],
};
