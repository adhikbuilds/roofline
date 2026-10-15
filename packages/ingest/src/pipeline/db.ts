import type { PoolClient } from 'pg';

/** The slice of a pg client the pipeline needs. Pass a Client or PoolClient; the run owns the transaction. */
export type Db = Pick<PoolClient, 'query'>;
