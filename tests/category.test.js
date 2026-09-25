import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app.js';
import User from '../models/user.js';
import Category from '../models/category.js';
import Todo from '../models/todo.js';
import { createUserWithToken } from './factories/user.factory.js';
import { createCategory } from './factories/category.factory.js';
import { createTodo } from './factories/todo.factory.js';

describe('Category Routes', () => {
  // =====================
  // LIST (GET /)
  // =====================
  describe('GET /api/categories', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app).get('/api/categories');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 401 com token inválido', async () => {
      const res = await request(app)
        .get('/api/categories')
        .set('Authorization', 'Bearer token-invalido');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .get('/api/categories')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 200 e lista vazia quando o usuário não tiver categorias', async () => {
      const { token } = await createUserWithToken();

      const res = await request(app)
        .get('/api/categories')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body).toHaveLength(0);
    });

    it('deve retornar 200 e apenas as categorias do usuário autenticado, ordenadas por nome', async () => {
      const { user, token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();

      await createCategory({ user: user._id, name: 'Trabalho' });
      await createCategory({ user: user._id, name: 'Compras' });
      await createCategory({ user: user._id, name: 'Pessoal' });
      await createCategory({ user: otherUser._id, name: 'Outro usuário' });

      const res = await request(app)
        .get('/api/categories')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.map((c) => c.name)).toEqual(['Compras', 'Pessoal', 'Trabalho']);
      expect(res.body[0]).toHaveProperty('_id');
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).not.toHaveProperty('user');
    });
  });

  // =====================
  // CREATE (POST /)
  // =====================
  describe('POST /api/categories', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app)
        .post('/api/categories')
        .send({ name: 'Pessoal' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Pessoal' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 422 se o nome não for informado', async () => {
      const { token } = await createUserWithToken();

      const res = await request(app)
        .post('/api/categories')
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
        .post('/api/categories')
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

    it('deve retornar 201 e criar a categoria para o usuário autenticado', async () => {
      const { user, token } = await createUserWithToken();

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Estudos' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Estudos');
      expect(res.body.user).toBe(user._id.toString());

      const created = await Category.findById(res.body._id);
      expect(created).toBeTruthy();
      expect(created.user.toString()).toBe(user._id.toString());
      expect(created.name).toBe('Estudos');
    });
  });

  // =====================
  // UPDATE (PUT /:id)
  // =====================
  describe('PUT /api/categories/:id', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app)
        .put('/api/categories/123')
        .send({ name: 'Novo nome' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Pessoal' });
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .put(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Casa' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 404 quando a categoria não existir', async () => {
      const { token } = await createUserWithToken();
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .put(`/api/categories/${fakeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Casa' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Categoria não encontrada.');
    });

    it('deve retornar 403 quando a categoria for de outro usuário', async () => {
      const { token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();
      const category = await createCategory({
        user: otherUser._id,
        name: 'Pessoal',
      });

      const res = await request(app)
        .put(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Invadir' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'Você não tem permissão para editar esta categoria.'
      );

      const unchanged = await Category.findById(category._id);
      expect(unchanged.name).toBe('Pessoal');
    });

    it('deve retornar 422 se o nome não for informado', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Pessoal' });

      const res = await request(app)
        .put(`/api/categories/${category._id}`)
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
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Pessoal' });

      const res = await request(app)
        .put(`/api/categories/${category._id}`)
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

    it('deve retornar 200 e atualizar o nome quando a categoria for do usuário', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Pessoal' });

      const res = await request(app)
        .put(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Casa' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Casa');
      expect(res.body._id).toBe(category._id.toString());

      const updated = await Category.findById(category._id);
      expect(updated.name).toBe('Casa');
    });
  });

  // =====================
  // DELETE (DELETE /:id)
  // =====================
  describe('DELETE /api/categories/:id', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app).delete(
        `/api/categories/${new mongoose.Types.ObjectId()}`
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Pessoal' });
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .delete(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 404 quando a categoria não existir', async () => {
      const { token } = await createUserWithToken();
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .delete(`/api/categories/${fakeId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Categoria não encontrada.');
    });

    it('deve retornar 403 quando a categoria for de outro usuário', async () => {
      const { token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();
      const category = await createCategory({
        user: otherUser._id,
        name: 'Pessoal',
      });

      const res = await request(app)
        .delete(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'Você não tem permissão para excluir esta categoria.'
      );

      const stillThere = await Category.findById(category._id);
      expect(stillThere).toBeTruthy();
    });

    it('deve retornar 409 quando a categoria possuir tarefas', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Compras' });
      await createTodo({
        user: user._id,
        category: category._id,
        description: 'Comprar pão',
      });

      const res = await request(app)
        .delete(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        'Categoria possui tarefas. Remova ou mova as tarefas antes de excluir.'
      );

      const stillThere = await Category.findById(category._id);
      expect(stillThere).toBeTruthy();

      const todos = await Todo.countDocuments({ category: category._id });
      expect(todos).toBe(1);
    });

    it('deve retornar 204 e excluir a categoria quando não houver tarefas', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Estudos' });

      const res = await request(app)
        .delete(`/api/categories/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      const deleted = await Category.findById(category._id);
      expect(deleted).toBeNull();
    });
  });
});