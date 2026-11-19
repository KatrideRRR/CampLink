import 'dotenv/config';
import { createAppServer } from './app.js';
import { createFirebasePushSender } from './push.js';

const PORT = Number(process.env.PORT || 5100);
const HOST = '127.0.0.1';

const { httpServer } = createAppServer({
    pushSender: createFirebasePushSender(),
});

httpServer.listen(PORT, HOST, () => {
    console.log(
        `CampLink API: http://${HOST}:${PORT}`
    );
});
