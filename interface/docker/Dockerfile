# Build Stage
FROM node:26-alpine AS build
WORKDIR ../

# We copy all of the needed local files into the docker container and run commands to install dependencies and build
COPY ./.babelrc ./.prettierrc.cjs ./eslint.config.js ./package.json ./tsconfig.json ./yarn.lock ./vite.config.ts ./index.html  ./
COPY ./docker/.env ./
COPY ./src ./src/
COPY ./public ./public/
COPY ./local-data ./local-data/

# Install corepack and therefore yarn
RUN npm install -g corepack
RUN corepack enable

RUN yarn install
RUN yarn run build:prod

# Production Stage
FROM node:26-alpine

WORKDIR /app
COPY --from=build /dist ./

RUN npm -g install serve

EXPOSE 8100

CMD ["serve", "-s", "-l", "8100", "."]
