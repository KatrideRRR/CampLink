
import { randomBytes } from 'node:crypto';
import { createStore } from './store.js';

const username = process.argv[2]?.trim().toLowerCase();

if (!username) {
    console.error(
        'Usage: npm run user:add -w backend -- username'
    );
    process.exitCode = 1;
} else {
    const store = createStore();

    try {
        const password = randomBytes(18).toString('base64url');
        const user = store.createUser(username, password);

        console.log('CampLink account created');
        console.log(`ID: ${user.id}`);
        console.log(`Username: ${user.username}`);
        console.log(`Temporary password: ${password}`);
        console.log('Save the password securely.');
    } catch (error) {
        console.error('Cannot create user:', error.message);
        process.exitCode = 1;
    } finally {
        store.close();
    }
}
