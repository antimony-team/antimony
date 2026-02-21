# Build Stage
FROM node:22-alpine AS build
WORKDIR /

# We copy all of the needed local files into the docker container and run commands to install dependencies and build
COPY .babelrc .prettierrc.cjs eslint.config.js package.json tsconfig.json yarn.lock .env ./
COPY webpack.common.cjs webpack.prod.cjs ./
COPY src/ ./src/
COPY public/ ./public/
COPY local-data/ ./local-data/

RUN yarn install

RUN yarn run build:prod

# Production Stage
FROM node:22-alpine

WORKDIR /app
COPY --from=build /build ./build

RUN npm -g install serve

EXPOSE 8100

CMD ["serve", "-s", "-l", "8100", "./build"]
