import { Router } from 'express';
import * as CategoryController from '../controllers/category.controller.js';
import {validate} from '../middlewares/validate.js'
import Auth from '../middlewares/auth.js'
import { categoryValidator } from '../validators/category.validator.js';
//import { registerValidator, loginValidator } from '../validators/user.validator.js'

const router = Router();


router.get('/', Auth,CategoryController.getCategories);
router.post('/', Auth, categoryValidator,validate, CategoryController.createCategory);
router.put('/:id', Auth,categoryValidator,validate, CategoryController.updateCategory);


export default router;