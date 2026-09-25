import bcryptjs from 'bcryptjs';
import jsonwebtoken from 'jsonwebtoken';
import User from '../models/user.js';
import Category from '../models/category.js';



export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
 
    
    // Verifica se o email já existe
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email já cadastrado.' });
    }

    // Hash da senha
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);
    

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
     });

    await newUser.save();

    await Category.insertMany([
      { user: newUser._id, name: 'Pessoal' },
      { user: newUser._id, name: 'Trabalho' },
      { user: newUser._id, name: 'Compras' },
    ]);
    
    const { password: _, ...userData } = newUser._doc;

    return res.status(201).json({
      message: 'Conta criada com sucesso.',
      user: userData
    });
  } catch (error) {
    console.error('Erro no register:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select(
      'name email password active avatar'
    );

    if (!user) {
      return res.status(400).json({ error: 'Email ou senha inválidos.' });
    }


    const isPasswordValid = await bcryptjs.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Email ou senha inválidos.' });
    }

     if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    

    const token = jsonwebtoken.sign(
      { userId: user._id },
      process.env.JWT_SECRET
    );

    const { password: _, ...rest } = user._doc;

   
    return res.status(200).json({
      ...rest,
      token
    });
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const validateToken = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;

    const user = await User.findById(userId).select('name email active avatar');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    
    return res.status(200).json(user);
  } catch (error) {
    console.error('Erro no validateToken:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const { name } = req.body;

    const user = await User.findById(userId).select('name email active isAdmin');

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada.' });
    }

    user.name = name;
    await user.save();

    return res.status(200).json(user);
  } catch (error) {
    console.error('Erro no updateProfile:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};