import { Router } from 'express';
import * as UserController from '../controllers/user.controller.js';
import {validate} from '../middlewares/validate.js'
import Auth from '../middlewares/auth.js'
import {
  registerValidator,
  loginValidator,
  updateProfileValidator,
} from '../validators/user.validator.js';

const router = Router();

router.post('/register', registerValidator, validate, UserController.register);
router.post('/login', loginValidator, validate, UserController.login);
router.get('/me', Auth, UserController.validateToken);
router.patch('/me', Auth, updateProfileValidator, validate, UserController.updateProfile);

export default router;


