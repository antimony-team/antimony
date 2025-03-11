# syntax=docker/dockerfile:1

FROM golang:1.24
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -v -o /antimony-server

EXPOSE 3000

CMD ["/antimony-server"]