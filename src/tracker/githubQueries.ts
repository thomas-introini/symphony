export const candidateIssuesQuery = `
query CandidateIssues($owner: String!, $repo: String!, $projectNumber: Int!, $after: String, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $projectNumber) {
      items(first: $first, after: $after) {
        nodes {
          content {
            ... on Issue {
              id
              number
              title
              body
              url
              createdAt
              updatedAt
              labels(first: 20) { nodes { name } }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
`;

export const statesByIdsQuery = `
query IssueStates($ids: [ID!]!, $owner: String!, $repo: String!, $projectNumber: Int!) {
  nodes(ids: $ids) {
    ... on Issue { id }
  }
  repository(owner: $owner, name: $repo) {
    projectV2(number: $projectNumber) {
      items(first: 100) {
        nodes {
          content { ... on Issue { id } }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
        }
      }
    }
  }
}
`;

export const projectStatusTransitionQuery = `
query ProjectStatusTransition($owner: String!, $repo: String!, $projectNumber: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $projectNumber) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
      items(first: 100, after: $after) {
        nodes {
          id
          content {
            ... on Issue {
              id
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

export const updateProjectItemStatusMutation = `
mutation UpdateProjectItemStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
`;
