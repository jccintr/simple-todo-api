import { describe, it, expect, beforeEach,vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import User from '../models/user.js';
import Category from '../models/category.js';
import {createUser,createUserWithToken} from './factories/user.factory.js'


import bcryptjs from 'bcryptjs';
//import cloudinary from '../utils/cloudinary.js';

const userPayload = {
  name: 'João Usuário',
  email: 'joao@test.com',
  password: '123456',
 
};

describe('Store Routes', () => {
  // =====================
  // REGISTER
  // =====================
  describe('POST /api/auth/register', () => {
    it('deve retornar 400 se o email já existir', async () => {
       
        const payload = {
          name: 'Frank Blak',
          email: 'frank@test.com',
          password: '123456',
         
        };
      

        // 1º cadastro precisa ter sucesso
        const first = await request(app)
          .post('/api/auth/register')
          .send(payload);

        expect(first.status).toBe(201);

        // 2º com o mesmo email
        const res = await request(app)
          .post('/api/auth/register')
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Email já cadastrado.');
      });
    it('deve retornar 422 se faltar campos obrigatórios', async () => {
    
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'incompleto@test.com' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toBeInstanceOf(Array);
    });
    it('deve cadastrar um usuário com três categorias padrão quando os dados forem válidos', async () => {
        
        const res = await request(app)
          .post('/api/auth/register')
          .send(userPayload);

        const userCategories = await Category.find({ user: res.body.user._id });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe('Conta criada com sucesso.');
        expect(res.body.user).toBeDefined();
        expect(res.body.user.email).toBe(userPayload.email);
        expect(res.body.user.password).toBeUndefined(); 
        expect(userCategories.length).toBe(3);
    });

    
  });
  // =====================
  // LOGIN
  // =====================
  describe('POST /api/auth/login', () => {
      beforeEach(async () => {
           const salt = await bcryptjs.genSalt(10);
           const hashedPassword = await bcryptjs.hash(userPayload.password, salt);
         
          
           await User.create({
             name: userPayload.name,
             email: userPayload.email,
             password: hashedPassword,
           
           });
      });
      it('deve fazer login com sucesso e retornar token', async () => {
        const res = await request(app)
          .post('/api/auth/login')
          .send({
            email: userPayload.email,
            password: userPayload.password,
          });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.email).toBe(userPayload.email);
        expect(res.body.password).toBeUndefined();
      });
      it('deve retornar 400 com senha incorreta', async () => {
            const res = await request(app)
              .post('/api/auth/login')
              .send({
                email: userPayload.email,
                password: 'senha-errada',
              });
      
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Email ou senha inválidos.');
      });
      it('deve retornar 400 com email inexistente', async () => {
            const res = await request(app)
              .post('/api/auth/login')
              .send({
                email: 'naoexiste@test.com',
                password: '123456',
              });
      
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Email ou senha inválidos.');
       });
       it('deve retornar 403 se a conta estiver desativada', async () => {
          await User.updateOne({ email: userPayload.email }, { active: false });

          const res = await request(app)
            .post('/api/auth/login')
            .send({
              email: userPayload.email,
              password: userPayload.password,
            });

          expect(res.status).toBe(403);
          expect(res.body.error).toBe('Conta desativada.');
       });
  });
   // =====================
  // VALIDATE TOKEN (GET /me)
  // =====================
  
   describe('GET /api/auth/me', () => {
    
    
    
      it('deve retornar os dados do usuario autenticado', async () => {
        const { user, token } = await createUserWithToken();
           const res = await request(app)
             .get('/api/auth/me')
             .set('Authorization', `Bearer ${token}`);
     
           expect(res.status).toBe(200);
           expect(res.body.email).toBe(user.email);
           expect(res.body.name).toBe(user.name);
           expect(res.body.password).toBeUndefined();
      });
      it('deve retornar 401 sem token', async () => {
          const res = await request(app).get('/api/auth/me');
    
          expect(res.status).toBe(401);
          expect(res.body.error).toBe('Não autorizado');
      });
      it('deve retornar 401 com token inválido', async () => {
            const res = await request(app)
              .get('/api/auth/me')
              .set('Authorization', 'Bearer token-invalido');
      
            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Não autorizado');
      });
      it('deve retornar 403 se a conta estiver desativada', async () => {
         const { user, token } = await createUserWithToken();
        await User.findByIdAndUpdate(user._id, { active: false });

        const res = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Conta desativada.');
     });

   });
   // =====================
// UPDATE PROFILE (PATCH /me)
// =====================
describe('PATCH /api/auth/me', () => {
  it('deve retornar 401 quando não autenticado (sem token)', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .send({ name: 'Novo Nome' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Não autorizado');
  });

  it('deve retornar 401 com token inválido', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', 'Bearer token-invalido')
      .send({ name: 'Novo Nome' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Não autorizado');
  });

  it('deve retornar 403 se a conta estiver desativada', async () => {
    const { user, token } = await createUserWithToken();
    await User.findByIdAndUpdate(user._id, { active: false });

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Novo Nome' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Conta desativada.');
  });

  it('deve retornar 422 se o nome não for informado', async () => {
    const { token } = await createUserWithToken();

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Dados inválidos');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'name',
          message: 'Nome é obrigatório',
        }),
      ])
    );
  });

  it('deve retornar 422 se o nome for uma string vazia', async () => {
    const { token } = await createUserWithToken();

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Dados inválidos');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'name',
          message: 'Nome é obrigatório',
        }),
      ])
    );
  });

  it('deve retornar 422 se o nome tiver menos de 3 caracteres', async () => {
    const { token } = await createUserWithToken();

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jo' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Dados inválidos');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'name',
          message: 'Nome deve ter pelo menos 3 caracteres',
        }),
      ])
    );
  });

  it('deve retornar 200 e atualizar apenas o nome', async () => {
    const { user, token } = await createUserWithToken({ name: 'Nome Antigo' });

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nome Novo' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nome Novo');
    expect(res.body.email).toBe(user.email);
    expect(res.body.password).toBeUndefined();

    const updated = await User.findById(user._id);
    expect(updated.name).toBe('Nome Novo');
    expect(updated.email).toBe(user.email);
  });

  it('deve ignorar email e password no body e atualizar só o nome', async () => {
    const { user, token } = await createUserWithToken({
      name: 'Original',
      email: 'original@test.com',
      password: '123456',
    });

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Só Nome',
        email: 'hack@test.com',
        password: 'outrasenha',
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Só Nome');

    const updated = await User.findById(user._id);
    expect(updated.name).toBe('Só Nome');
    expect(updated.email).toBe('original@test.com');

    const stillValid = await bcryptjs.compare('123456', updated.password);
    expect(stillValid).toBe(true);
  });
});
 
});