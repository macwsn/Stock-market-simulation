FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN go mod tidy && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/audit .

FROM alpine:3.19
RUN adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/audit /app/audit
USER app
EXPOSE 8082
ENTRYPOINT ["/app/audit"]
