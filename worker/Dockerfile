# 自托管常驻（daemon 模式）。也可改 CMD 为 --once 配外部 cron。
FROM node:22-alpine
WORKDIR /app
COPY . /app
# 无第三方依赖即可跑 Telegram/Webhook；如需邮件，RUN npm i nodemailer
ENV LUMINA_CONFIG=/app/worker/config.json
CMD ["node","--experimental-strip-types","worker/push-worker.mjs","--daemon"]
