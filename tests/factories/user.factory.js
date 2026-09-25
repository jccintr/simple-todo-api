import bcryptjs from 'bcryptjs';
import jsonwebtoken from 'jsonwebtoken';
import User from '../../models/user.js';


/**
 * Cria um Rider no banco.
 * @param {object} overrides - campos para sobrescrever os defaults
 * @returns {Promise<import('mongoose').Document>}
 */

export async function createUser(overrides = {}) {

  const password = overrides.password || '123456';
  const hashedPassword = await bcryptjs.hash(password, 10);
 

  const user = await User.create({
      name: 'User Teste',
      email: `user${Date.now()}@test.com`,
      password: hashedPassword,
      ...overrides,
      password: overrides.password  ? await bcryptjs.hash(overrides.password, 10) : hashedPassword,
 });
  
 return user;

}

/**
 * Cria um Rider + token JWT prontos para usar nos testes autenticados.
 * @param {object} overrides
 * @returns {Promise<{ rider: object, token: string }>}
 */
export async function createUserWithToken(overrides = {}) {
  const user = await createUser(overrides);

  const token = jsonwebtoken.sign(
    { userId: user._id },
    process.env.JWT_SECRET
  );

  return { user, token };
}