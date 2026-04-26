# Stage 1: Build
FROM node:18-alpine AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src

# Stage 2: Production
FROM node:18-alpine AS production
WORKDIR /usr/src/app
# Set non-root user
USER node
COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/src ./src
COPY --chown=node:node package.json ./

EXPOSE 3000
CMD ["npm", "start"]

# yes
