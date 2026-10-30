import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "NomadeControl";
export default defineRailway(() => {
  const NomadeControl = service("NomadeControl", {
    source: github("antireno11-wq/NomadeControl", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "sh start.sh",
    healthcheck: "/login",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    domains: ["control.nomadechile.cl"],
    networking: { privateNetworkEndpoint: "nomadecontrol" },
  });

  return project("Nomade Control", {
    variables: { managed: false },
    resources: [NomadeControl],
  });
});
