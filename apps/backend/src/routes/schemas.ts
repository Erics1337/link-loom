export const looseObjectBodySchema = {
    type: 'object',
    additionalProperties: true
};

export const userIdParamsSchema = {
    type: 'object',
    required: ['userId'],
    properties: {
        userId: { type: 'string', minLength: 1 }
    }
};

export const snapshotParamsSchema = {
    type: 'object',
    required: ['userId', 'snapshotId'],
    properties: {
        userId: { type: 'string', minLength: 1 },
        snapshotId: { type: 'string', minLength: 1 }
    }
};

export const errorResponseSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        error: { type: 'string' }
    }
};

export const statusOkResponseSchema = {
    200: {
        type: 'object',
        required: ['status'],
        properties: {
            status: { type: 'string' }
        }
    }
};

export const authenticatedStatusResponseSchema = {
    ...statusOkResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    500: errorResponseSchema
};

export const objectArrayPropertySchema = {
    type: 'array',
    items: { type: 'object', additionalProperties: true }
};
