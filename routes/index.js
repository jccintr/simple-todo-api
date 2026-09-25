import { Router } from 'express';
import authRoutes from './auth.routes.js';
import categoryRoutes from './category.routes.js';
import todoRoutes from './todo.routes.js';
//import todoRoutes from './todo.routes.js';


const router = Router();

router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/todos', todoRoutes);
//router.use('/todos', todoRoutes);



export default router;