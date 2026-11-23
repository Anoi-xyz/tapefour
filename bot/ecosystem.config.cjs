// bot/ecosystem.config.cjs
// PM2 Process Manager configuration for TapeFour Bot Operator
// Run with:
//   pm2 start bot/ecosystem.config.cjs
//   pm2 logs tapefour-operator
//   pm2 status

module.exports = {
  apps: [
    {
      name: 'tapefour-operator',
      script: 'npx',
      args: 'tsx bot/operator.ts',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        BOT_DIFFICULTY: 'medium',
      },
      error_file: 'logs/operator-error.log',
      out_file: 'logs/operator-out.log',
      time: true,
    },
  ],
};
