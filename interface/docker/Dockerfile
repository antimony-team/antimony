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
COPY ./src ./src/
COPY ./public ./public/

# CI passes the version of a release tag, other builds keep the development version. The commit is shown
# with development versions, as the image is built without the repository.
ARG VERSION
ARG SB_COMMIT
RUN if [ -n "$VERSION" ]; then yarn version --new-version "$VERSION" --no-git-tag-version; fi

RUN yarn build

# Production Stage
FROM node:26-alpine

WORKDIR /app
COPY --from=build /dist ./

RUN npm -g install serve

EXPOSE 8100

CMD ["serve", "-s", "-l", "8100", "."]
