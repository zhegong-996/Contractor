declare module 'suitme/cognee-graph' {
  import type { ComponentType } from 'react';
  const Graph: ComponentType<any>;
  export default Graph;
}
declare module 'suitme/cognee-schema' {
  export function schemaReducer(schema: any, action: any): any;
  export function emptySchema(): any;
}
