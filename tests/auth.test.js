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
   /*
  
  // =====================
  // Update Profile (PATCH /me)
  // =====================
  describe('PATCH /api/stores/me', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app).patch('/api/stores/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });
    it('deve retornar 404 quando store não existir', async () => {
      const { store,token } = await createStoreWithToken();
      await Store.findByIdAndDelete(store._id);
      const res = await request(app)
        .patch('/api/stores/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'John Doe',phone: '1234567890' ,doc: '1234567890' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Loja não encontrada.');
    });
    it('deve retornar 403 quando a conta estiver não estiver verificada', async () => {
      const { store,token } = await createStoreWithToken();
      
      const res = await request(app)
        .patch('/api/stores/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'John Doe',phone: '3534567890' ,doc: '1234567890' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta ainda não verificada.');
    });
    
    it('deve retornar 403 quando a conta estiver desativada', async () => {
      const { store,token } = await createStoreWithToken();
      await Store.findByIdAndUpdate(store._id, { active: false, emailVerifiedAt: new Date() });
      const res = await request(app)
        .patch('/api/stores/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'John Doe',phone: '3534567890' ,doc: '1234567890' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });
    it('deve retornar 400 quando nome tiver menos do que 3 caractres', async () => {
      const { store,token } = await createStoreWithToken();
      const res = await request(app)
        .patch('/api/stores/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jo',phone: '1234567890' ,doc: '1234567890' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toBeInstanceOf(Array);
      expect(res.body.details[0].message).toBe('Nome deve ter pelo menos 3 caracteres.');
    });
    it('deve retornar 400 quando o estado for inválido', async () => {
      const { store,token } = await createStoreWithToken();
      const res = await request(app)
        .patch('/api/stores/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Cesar Burg',phone: '1234567890' ,doc: '1234567890', address: { state: 'XX' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toBeInstanceOf(Array);
      expect(res.body.details[0].message).toBe('Estado inválido.');
    });
    
    it('deve retornar 400 quando phone estiver em branco', async () => {
      const { store,token } = await createStoreWithToken();
      const res = await request(app)
        .patch('/api/stores/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'John Doe',phone: '' ,doc: '1234567890' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toBeInstanceOf(Array);
      expect(res.body.details[0].message).toBe('Telefone inválido.');
    });
    it('deve retornar 200, atualizar a loja e retornar a loja atualizada quando a loja existir, estiver validada e os dados forem validos', async () => { 
    const { store,token } = await createStoreWithToken({emailVerifiedAt: new Date() });
    
    const res = await request(app)
      .patch('/api/stores/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'John Doe',phone: '3534567890' ,doc: '1234567890', address: { state: 'SP' } });
    const updated = await Store.findById(store._id);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(updated.name);
    expect(res.body.phone).toBe(updated.phone);
    expect(res.body.doc).toBe(updated.doc);
    expect(res.body.address.state).toBe(updated.address.state);
    expect(res.body.emailVerificationCode).toBeUndefined();
    expect(res.body.resetPasswordCode).toBeUndefined();
    expect(res.body.password).toBeUndefined();
    });
    
  });
  
  // =====================
  // Upload Avatar (PATCH /me/avatar)
  // =====================
  describe('PATCH /api/stores/me/avatar', () => {
    beforeEach(() => {
      vi.mock('../utils/cloudinary.js', async () => {
        const mock = await import('./mocks/cloudinary.js');
        return { default: mock.default };
      });
    });

    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app).patch('/api/stores/me/avatar');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 400 quando nenhuma imagem for enviada', async () => {
      const { token } = await createStoreWithToken();

      const res = await request(app)
        .patch('/api/stores/me/avatar')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Nenhuma imagem enviada.');
    });

    it('deve rejeitar arquivo que não seja imagem', async () => {
      const { token } = await createStoreWithToken();

      const res = await request(app)
        .patch('/api/stores/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', Buffer.from('not-an-image'), 'file.txt');

      expect([400, 500]).toContain(res.status);
    });

    it('deve retornar 200 e atualizar o avatar quando a imagem for válida', async () => {
      const { store, token } = await createStoreWithToken();

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .patch('/api/stores/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', pngBuffer, 'avatar.png');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Avatar atualizado com sucesso.');
      expect(res.body.avatar).toBe(
        'https://res.cloudinary.com/demo/image/upload/v1/delivroo/riders/rider_test.jpg'
      );

      const updated = await Store.findById(store._id).select('avatar');
      expect(updated.avatar).toBe(res.body.avatar);
    });

    it('deve retornar 404 quando a loja não existir', async () => {
      const { store, token } = await createStoreWithToken();
      await Store.findByIdAndDelete(store._id);

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .patch('/api/stores/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', pngBuffer, 'avatar.png');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Loja não encontrada.');
    });

    it('deve retornar 500 quando o Cloudinary falhar', async () => {
      cloudinary.uploader.upload_stream.mockImplementationOnce((options, callback) => {
        return {
          end: () => callback(new Error('Cloudinary error'), null),
        };
      });

      const { token } = await createStoreWithToken();
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .patch('/api/stores/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', pngBuffer, 'avatar.png');

      expect(res.status).toBe(500);
    });
  });
*/
});