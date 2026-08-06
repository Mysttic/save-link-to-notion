import { useEffect, useState } from 'react';
import { sendMessage } from '../messages';
import type { DatabaseSchema } from '../types';

/** Live column names of the configured database, used to offer existing tags. */
export const useDatabaseSchema = () => {
    const [schema, setSchema] = useState<DatabaseSchema | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const response = await sendMessage({ type: 'FETCH_SCHEMA' });
            if (!cancelled && response.success) setSchema(response.schema);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return schema;
};
