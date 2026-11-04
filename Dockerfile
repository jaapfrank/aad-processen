# One image, one isolated organisation per container. Build the frontend from the lockfile.
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY contract/ /src/contract/
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:4beef5b8919dcaa2dc924233bd069257e883cc7a061e09088a97d152d6a48510 AS build
ARG TARGETARCH
WORKDIR /src
COPY backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj backend/src/ServiceProcesgids.Api/
RUN if [ "$TARGETARCH" = "amd64" ]; then RID=linux-x64; else RID=linux-$TARGETARCH; fi; \
    dotnet restore backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj --runtime "$RID"
COPY backend/src/ServiceProcesgids.Api/ backend/src/ServiceProcesgids.Api/
COPY contract/ contract/
COPY --from=frontend /src/frontend/dist /frontend-dist
RUN if [ "$TARGETARCH" = "amd64" ]; then RID=linux-x64; else RID=linux-$TARGETARCH; fi; \
    dotnet publish backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj \
    --configuration Release --no-restore --runtime "$RID" --self-contained false \
    --output /out -p:FrontendDistPath=/frontend-dist -p:DebugType=None -p:DebugSymbols=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:011bb5f30180717b1c8b65822ff2c99bcb96bc65af0164589751b83c7b4949f7 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
RUN mkdir /app/App_Data && chown -R app:app /app/App_Data
USER app
ENV ASPNETCORE_HTTP_PORTS=8080 ASPNETCORE_ENVIRONMENT=Production URLS=http://+:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8080/api/health/ready || exit 1
ENTRYPOINT ["dotnet", "ServiceProcesgids.Api.dll"]
