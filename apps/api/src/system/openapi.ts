type OpenApiBuildInput = {
  host: string;
  port: number;
};

export function buildOpenApiSpec(input: OpenApiBuildInput) {
  const server = `http://${input.host}:${input.port}`;
  return {
    openapi: "3.0.3",
    info: {
      title: "OCC API",
      version: "1.0.0",
      description: "OpenClaw Collaboration Center API"
    },
    servers: [{ url: server }],
    paths: {
      "/health": {
        get: {
          summary: "健康检查",
          responses: {
            "200": { description: "OK" }
          }
        }
      },
      "/ready": {
        get: {
          summary: "就绪检查",
          responses: {
            "200": { description: "Ready" },
            "503": { description: "Not ready" }
          }
        }
      },
      "/api/docs.json": {
        get: {
          summary: "OpenAPI 文档",
          responses: {
            "200": { description: "OpenAPI JSON" }
          }
        }
      }
    }
  };
}
