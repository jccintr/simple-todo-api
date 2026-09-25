import jsonwebtoken from 'jsonwebtoken';

const Auth = (req, res, next) => {
  const bearer = req.headers['authorization'];

  if (!bearer) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const token = bearer.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);

    // Boa prática: coloca o usuário autenticado em req.user
    req.user = {
      id: decoded.userId,
      role: 'user'
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
};

export default Auth;