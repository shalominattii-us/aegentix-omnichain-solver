FROM alpine:3.20 AS build
RUN apk add --no-cache build-base cmake
WORKDIR /src
COPY . .
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --parallel && ctest --test-dir build --output-on-failure
FROM alpine:3.20
RUN addgroup -S ocd && adduser -S -G ocd ocd
COPY --from=build /src/build/omnicyberdex-edge /usr/local/bin/omnicyberdex-edge
USER ocd
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/omnicyberdex-edge","8080"]
