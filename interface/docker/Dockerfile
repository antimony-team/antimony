# Build Stage
# The built files are the same on every platform, so they are built once on the platform of the build machine
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR ../

# Install corepack and therefore yarn
RUN npm install -g corepack
RUN corepack enable

# The dependencies are installed before the sources are copied, so changed sources keep them cached
COPY ./package.json ./yarn.lock ./
COPY ./patches ./patches/

# The image only serves the web build, which doesn't need the Electron binary
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN yarn install

# We copy all of the needed local files into the docker container and build
COPY ./.babelrc ./.prettierrc.cjs ./eslint.config.js ./tsconfig.json ./vite.config.ts ./index.html  ./
COPY ./docker/.env ./
COPY ./src ./src/
COPY ./public ./public/
COPY ./local-data ./local-data/

RUN yarn run build:prod

# Production Stage
FROM node:26-alpine

WORKDIR /app
COPY --from=build /dist ./

RUN npm -g install serve

EXPOSE 8100

CMD ["serve", "-s", "-l", "8100", "."]
