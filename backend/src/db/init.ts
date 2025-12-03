import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function initDb() {
    // 1. Connect to default 'postgres' database to create the new DB
    const defaultClient = new Client({
        connectionString: process.env.DATABASE_URL?.replace('/linkloom', '/postgres')
    });

    try {
        await defaultClient.connect();
        console.log('Connected to default postgres database.');

        // Check if database exists
        const res = await defaultClient.query("SELECT 1 FROM pg_database WHERE datname = 'linkloom'");
        if (res.rowCount === 0) {
            console.log("Database 'linkloom' not found. Creating...");
            await defaultClient.query('CREATE DATABASE linkloom');
            console.log("Database 'linkloom' created.");
        } else {
            console.log("Database 'linkloom' already exists.");
        }
    } catch (err) {
        console.error('Error checking/creating database:', err);
        process.exit(1);
    } finally {
        await defaultClient.end();
    }

    // 2. Connect to 'linkloom' database to apply schema
    const targetClient = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await targetClient.connect();
        console.log('Connected to linkloom database.');

        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Initializing database schema...');
        await targetClient.query(schemaSql);
        console.log('Database initialized successfully!');
    } catch (err) {
        console.error('Error initializing schema:', err);
        process.exit(1);
    } finally {
        await targetClient.end();
        process.exit(0);
    }
}

initDb();
