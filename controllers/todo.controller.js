import Todo from '../models/todo.js';
import User from '../models/user.js';
import Category from '../models/category.js';

export const createTodo = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const { description, categoryId, priority } = req.body;

    const category = await Category.findById(categoryId);

    if (!category) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    const newTodo = new Todo({
      user: userId,
      description,
      category: categoryId,
      priority,
    });

    await newTodo.save();

    return res.status(201).json(newTodo);

  } catch (error) {
    console.error('Erro no validateToken:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const getAllByCategory = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);
   
    if (!category) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

   const todos = await Todo.find({ user: userId, category: categoryId }).sort({ createdAt: -1 });

    return res.status(200).json(todos);

  } catch (error) {
    console.error('Erro no validateToken:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};



export const deleteTodo = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const { id } = req.params;

    const todo = await Todo.findById(id);

    if (!todo) {
      return res.status(404).json({ error: 'Todo não encontrado.' });
    }

    if (todo.user.toString() !== userId.toString()) {
      return res.status(403).json({ error: 'Você não tem permissão para excluir este todo.' });
    }

    await todo.deleteOne();

   return res.status(204).send();

  } catch (error) {
    console.error('Erro no validateToken:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const updateTodo = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const { id } = req.params;
    const { description, done, priority, categoryId } = req.body;

    const todo = await Todo.findById(id);

    if (!todo) {
      return res.status(404).json({ error: 'Todo não encontrado.' });
    }

    if (todo.user.toString() !== userId.toString()) {
      return res.status(403).json({
        error: 'Você não tem permissão para editar este todo.',
      });
    }

    if (categoryId !== undefined) {
      const category = await Category.findById(categoryId);

      if (!category) {
        return res.status(404).json({ error: 'Categoria não encontrada.' });
      }

      if (category.user.toString() !== userId.toString()) {
        return res.status(403).json({
          error: 'Você não tem permissão para usar esta categoria.',
        });
      }

      todo.category = categoryId;
    }

    if (description !== undefined) todo.description = description;
    if (done !== undefined) todo.done = done;
    if (priority !== undefined) todo.priority = priority;

    const updatedTodo = await todo.save();

    return res.status(200).json(updatedTodo);
  } catch (error) {
    console.error('Erro no updateTodo:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};