# syntax=docker/dockerfile:1

FROM golang:1.24
WORKDIR /app

RUN go env -w GOCACHE=/go-cache
RUN go env -w GOMODCACHE=/gomod-cache

COPY src/go.mod src/go.sum ./
RUN --mount=type=cache,target=/gomod-cache go mod download

COPY src .
COPY .env .
RUN --mount=type=cache,target=/gomod-cache --mount=type=cache,target=/go-cache go build -v -o /antimony-server

COPY test/config.test.yml ./config.yml

EXPOSE 3000

CMD ["/antimony-server"]