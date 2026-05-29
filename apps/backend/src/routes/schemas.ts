export const looseObjectBodySchema = {
    type: 'object',
    additionalProperties: true,
};

export const userIdParamsSchema = {
    type: 'object',
    required: ['userId'],
    properties: {
        userId: { type: 'string', minLength: 1 },
    },
};

export const snapshotParamsSchema = {
    type: 'object',
    required: ['userId', 'snapshotId'],
    properties: {
        userId: { type: 'string', minLength: 1 },
        snapshotId: { type: 'string', minLength: 1 },
    },
};

export const errorResponseSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        error: { type: 'string' },
    },
};
