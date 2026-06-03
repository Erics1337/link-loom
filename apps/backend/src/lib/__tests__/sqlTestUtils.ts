import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const readMigrationSql = (fileName: string) =>
    readFileSync(
        resolve(__dirname, '../../../../../supabase/migrations', fileName),
        'utf8'
    );

export const functionBlockFromSql = (sql: string, name: string) => {
    const pattern = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i'
    );
    const match = sql.match(pattern);
    if (!match) {
        throw new Error(`Could not find function ${name}.`);
    }
    return match[0];
};
