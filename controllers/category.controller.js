import Category from '../models/category.js';
import User from '../models/user.js';
import Todo from '../models/todo.js';

export const createCategory = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const { name } = req.body;

    const newCategory = new Category({
      user: userId,
      name,
    });

    await newCategory.save();

    return res.status(201).json(newCategory);

  } catch (error) {
    console.error('Erro no validateToken:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};


export const getCategories = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const categories = await Category.find({ user: userId }).select('name').sort({ name: 1 });

    return res.status(200).json(categories);


  } catch (error) {
    console.error('Erro no validateToken:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const { name } = req.body;
    const categoryId = req.params.id;

    const category = await Category.findById(categoryId);

    if (!category) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    if (category.user.toString() !== userId.toString()) {
      return res.status(403).json({ error: 'Você não tem permissão para editar esta categoria.' });
    }

    category.name = name;
    const updatedCategory = await category.save();

    return res.status(200).json(updatedCategory);
  } catch (error) {
    console.error('Erro no updateCategory:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const categoryId = req.params.id;

    const user = await User.findById(userId).select('active');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    const category = await Category.findById(categoryId);

    if (!category) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    if (category.user.toString() !== userId.toString()) {
      return res.status(403).json({
        error: 'Você não tem permissão para excluir esta categoria.',
      });
    }

    const todosCount = await Todo.countDocuments({
      category: categoryId,
      user: userId,
    });

    if (todosCount > 0) {
      return res.status(409).json({
        error: 'Categoria possui tarefas. Remova ou mova as tarefas antes de excluir.',
      });
    }

    await category.deleteOne();

    return res.status(204).send();
  } catch (error) {
    console.error('Erro no deleteCategory:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};