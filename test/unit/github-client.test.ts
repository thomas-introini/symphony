import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { GitHubClient } from "../../src/tracker/githubClient.js";

const logger = { info: () => {}, warn: () => {} };

describe("github client", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    servers.length = 0;
  });

  it("fetches paginated candidates and filters active states", async () => {
    let requests = 0;
    const server = http.createServer((req, res) => {
      requests += 1;
      let body = "";
      req.on("data", (d) => {
        body += d.toString("utf8");
      });
      req.on("end", () => {
        const parsed = JSON.parse(body) as { variables?: { after?: string } };
        if (!parsed.variables?.after) {
          res.end(
            JSON.stringify({
              data: {
                repository: {
                  projectV2: {
                    items: {
                      nodes: [
                        {
                          content: {
                            id: "i1",
                            number: 1,
                            title: "A",
                            body: "",
                            url: "u1",
                            createdAt: "2026-01-01T00:00:00Z",
                            updatedAt: "2026-01-01T00:00:00Z",
                            labels: { nodes: [{ name: "Bug" }] }
                          },
                          fieldValues: { nodes: [{ name: "In Progress", field: { name: "Status" } }] }
                        }
                      ],
                      pageInfo: { hasNextPage: true, endCursor: "cursor-1" }
                    }
                  }
                }
              }
            })
          );
          return;
        }
        res.end(
          JSON.stringify({
            data: {
              repository: {
                projectV2: {
                  items: {
                    nodes: [
                      {
                        content: {
                          id: "i2",
                          number: 2,
                          title: "B",
                          body: "",
                          url: "u2",
                          createdAt: "2026-01-01T00:00:00Z",
                          updatedAt: "2026-01-01T00:00:00Z",
                          labels: { nodes: [] }
                        },
                        fieldValues: { nodes: [{ name: "Done", field: { name: "Status" } }] }
                      }
                    ],
                    pageInfo: { hasNextPage: false, endCursor: "" }
                  }
                }
              }
            }
          })
        );
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const client = new GitHubClient(
      {
        kind: "github",
        endpoint: `http://127.0.0.1:${addr.port}`,
        apiKey: "token",
        owner: "o",
        repo: "r",
        projectNumber: 1,
        activeStates: ["Todo", "In Progress"],
        terminalStates: [],
        statusFieldName: "Status",
        priorityFieldName: "Priority"
      },
      logger
    );

    const issues = await client.fetchCandidateIssues(AbortSignal.timeout(5000));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe("i1");
    expect(requests).toBe(2);
  });
});
