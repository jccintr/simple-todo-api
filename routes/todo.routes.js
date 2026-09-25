import { Router } from 'express';
import * as TodoController from '../controllers/todo.controller.js';
import {validate} from '../middlewares/validate.js'
import Auth from '../middlewares/auth.js'
import { createValidator, updateValidator } from '../validators/todo.validator.js';


const router = Router();



router.post('/', Auth, createValidator,validate, TodoController.createTodo);
router.get('/category/:categoryId', Auth, TodoController.getAllByCategory);
router.patch('/:id', Auth, updateValidator, validate, TodoController.updateTodo);
router.delete('/:id', Auth, TodoController.deleteTodo);


export default router;