import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from '../index';

const proxyPromise = buildApp().then((app) => awsLambdaFastify(app));

export const handler = async (event: any, context: any) => {
    const proxy = await proxyPromise;
    return proxy(event, context);
};
