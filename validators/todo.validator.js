import { body } from 'express-validator';

export const createValidator = [
  body('description')
    .trim()
    .notEmpty().withMessage('Descrição é obrigatória')
    .isLength({ min: 3 }).withMessage('Descrição deve ter pelo menos 3 caracteres'),

  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Prioridade inválida. Deve ser low, medium ou high'),

  body('categoryId')
    .exists({ checkFalsy: true })
    .withMessage('Categoria é obrigatória')
    .bail()
    .isMongoId()
    .withMessage('ID da categoria inválido'),
];

export const updateValidator = [
  body('description')
    .optional()
    .trim()
    .notEmpty().withMessage('Descrição é obrigatória')
    .isLength({ min: 3 }).withMessage('Descrição deve ter pelo menos 3 caracteres'),

  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Prioridade inválida. Deve ser low, medium ou high'),

  body('done')
    .optional()
    .isBoolean().withMessage('Done deve ser boolean')
    .toBoolean(),

  body('categoryId')
    .optional()
    .isMongoId().withMessage('ID da categoria inválido'),
];

