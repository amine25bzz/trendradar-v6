import { createHandlers, nodeHandler } from '../lib/handlers.js';

const h = createHandlers();
export default nodeHandler(h.trends);
