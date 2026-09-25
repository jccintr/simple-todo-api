import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app.js';
import User from '../models/user.js';
import Todo from '../models/todo.js';
import { createUserWithToken } from './factories/user.factory.js';
import { createCategory } from './factories/category.factory.js';
import { createTodo } from './factories/todo.factory.js';

describe('Todo Routes', () => {
  // =====================
  // CREATE (POST /)
  // =====================
  describe('POST /api/todos', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app)
        .post('/api/todos')
        .send({ description: 'Comprar pão', categoryId: new mongoose.Types.ObjectId() });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Comprar pão', categoryId: category._id });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 422 se a descrição não for informada', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ categoryId: category._id });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'description',
            message: 'Descrição é obrigatória',
          }),
        ])
      );
    });

    it('deve retornar 422 se a descrição for uma string vazia', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: '', categoryId: category._id });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'description',
            message: 'Descrição é obrigatória',
          }),
        ])
      );
    });

    it('deve retornar 422 se a descrição tiver menos de 3 caracteres', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'ab', categoryId: category._id });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'description',
            message: 'Descrição deve ter pelo menos 3 caracteres',
          }),
        ])
      );
    });

    it('deve retornar 422 se a prioridade for inválida', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Comprar pão',
          categoryId: category._id,
          priority: 'urgente',
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'priority',
            message: 'Prioridade inválida. Deve ser low, medium ou high',
          }),
        ])
      );
    });

    it('deve retornar 422 se a categoria não for informada', async () => {
      const { token } = await createUserWithToken();

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Comprar pão' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'categoryId',
            message: 'Categoria é obrigatória',
          }),
        ])
      );
    });

    it('deve retornar 422 se o categoryId for inválido', async () => {
      const { token } = await createUserWithToken();

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Comprar pão', categoryId: '123' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'categoryId',
            message: 'ID da categoria inválido',
          }),
        ])
      );
    });

    it('deve retornar 404 quando a categoria não existir', async () => {
      const { token } = await createUserWithToken();
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Comprar pão', categoryId: fakeId });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Categoria não encontrada.');
    });

    it('deve retornar 201 e criar o todo para o usuário autenticado', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id, name: 'Compras' });

      const res = await request(app)
        .post('/api/todos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Comprar pão',
          categoryId: category._id,
          priority: 'high',
        });

      expect(res.status).toBe(201);
      expect(res.body.description).toBe('Comprar pão');
      expect(res.body.priority).toBe('high');
      expect(res.body.done).toBe(false);
      expect(res.body.user).toBe(user._id.toString());
      expect(res.body.category).toBe(category._id.toString());

      const created = await Todo.findById(res.body._id);
      expect(created).toBeTruthy();
      expect(created.description).toBe('Comprar pão');
    });
  });

  // =====================
  // LIST BY CATEGORY (GET /category/:categoryId)
  // =====================
  describe('GET /api/todos/category/:categoryId', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app).get(
        `/api/todos/category/${new mongoose.Types.ObjectId()}`
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .get(`/api/todos/category/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 404 quando a categoria não existir', async () => {
      const { token } = await createUserWithToken();
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .get(`/api/todos/category/${fakeId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Categoria não encontrada.');
    });

    it('deve retornar 200 e lista vazia quando não houver todos na categoria', async () => {
      const { user, token } = await createUserWithToken();
      const category = await createCategory({ user: user._id });

      const res = await request(app)
        .get(`/api/todos/category/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body).toHaveLength(0);
    });

    it('deve retornar 200 e apenas os todos do usuário naquela categoria', async () => {
      const { user, token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();

      const category = await createCategory({ user: user._id, name: 'Compras' });
      const otherCategory = await createCategory({ user: user._id, name: 'Trabalho' });
      const otherUserCategory = await createCategory({
        user: otherUser._id,
        name: 'Compras',
      });

      await createTodo({
        user: user._id,
        category: category._id,
        description: 'Comprar leite',
      });
      await createTodo({
        user: user._id,
        category: category._id,
        description: 'Comprar pão',
      });
      await createTodo({
        user: user._id,
        category: otherCategory._id,
        description: 'Enviar relatório',
      });
      await createTodo({
        user: otherUser._id,
        category: otherUserCategory._id,
        description: 'Todo de outro usuário',
      });

      const res = await request(app)
        .get(`/api/todos/category/${category._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const descriptions = res.body.map((t) => t.description);
      expect(descriptions).toEqual(
        expect.arrayContaining(['Comprar leite', 'Comprar pão'])
      );
      expect(descriptions).not.toContain('Enviar relatório');
      expect(descriptions).not.toContain('Todo de outro usuário');
    });
  });

  // =====================
  // UPDATE (PATCH /:id)
  // =====================
  describe('PATCH /api/todos/:id', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app)
        .patch(`/api/todos/${new mongoose.Types.ObjectId()}`)
        .send({ description: 'Novo texto' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Novo texto' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 404 quando o todo não existir', async () => {
      const { token } = await createUserWithToken();
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/todos/${fakeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Novo texto' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Todo não encontrado.');
    });

    it('deve retornar 403 quando o todo for de outro usuário', async () => {
      const { token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();
      const todo = await createTodo({
        user: otherUser._id,
        description: 'Todo alheio',
      });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Invadir' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'Você não tem permissão para editar este todo.'
      );

      const unchanged = await Todo.findById(todo._id);
      expect(unchanged.description).toBe('Todo alheio');
    });

    it('deve retornar 422 se a descrição tiver menos de 3 caracteres', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'ab' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'description',
            message: 'Descrição deve ter pelo menos 3 caracteres',
          }),
        ])
      );
    });

    it('deve retornar 422 se a prioridade for inválida', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ priority: 'urgente' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'priority',
            message: 'Prioridade inválida. Deve ser low, medium ou high',
          }),
        ])
      );
    });

    it('deve retornar 422 se o categoryId for inválido', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ categoryId: '123' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'categoryId',
            message: 'ID da categoria inválido',
          }),
        ])
      );
    });

    it('deve retornar 404 quando a nova categoria não existir', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ categoryId: fakeId });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Categoria não encontrada.');
    });

    it('deve retornar 403 quando a nova categoria for de outro usuário', async () => {
      const { user, token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });
      const otherCategory = await createCategory({
        user: otherUser._id,
        name: 'Alheia',
      });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ categoryId: otherCategory._id });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'Você não tem permissão para usar esta categoria.'
      );
    });

    it('deve retornar 200 e atualizar description, done, priority e category', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({
        user: user._id,
        description: 'Comprar pão',
        priority: 'low',
        done: false,
      });
      const newCategory = await createCategory({
        user: user._id,
        name: 'Trabalho',
      });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Enviar relatório',
          done: true,
          priority: 'high',
          categoryId: newCategory._id,
        });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Enviar relatório');
      expect(res.body.done).toBe(true);
      expect(res.body.priority).toBe('high');
      expect(res.body.category).toBe(newCategory._id.toString());

      const updated = await Todo.findById(todo._id);
      expect(updated.description).toBe('Enviar relatório');
      expect(updated.done).toBe(true);
      expect(updated.priority).toBe('high');
      expect(updated.category.toString()).toBe(newCategory._id.toString());
    });

    it('deve retornar 200 e atualizar somente o campo done (update parcial)', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({
        user: user._id,
        description: 'Comprar pão',
        priority: 'medium',
        done: false,
      });

      const res = await request(app)
        .patch(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ done: true });

      expect(res.status).toBe(200);
      expect(res.body.done).toBe(true);
      expect(res.body.description).toBe('Comprar pão');
      expect(res.body.priority).toBe('medium');
    });
  });

  // =====================
  // DELETE (DELETE /:id)
  // =====================
  describe('DELETE /api/todos/:id', () => {
    it('deve retornar 401 quando não autenticado (sem token)', async () => {
      const res = await request(app).delete(
        `/api/todos/${new mongoose.Types.ObjectId()}`
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Não autorizado');
    });

    it('deve retornar 403 se a conta estiver desativada', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });
      await User.findByIdAndUpdate(user._id, { active: false });

      const res = await request(app)
        .delete(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Conta desativada.');
    });

    it('deve retornar 404 quando o todo não existir', async () => {
      const { token } = await createUserWithToken();
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .delete(`/api/todos/${fakeId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Todo não encontrado.');
    });

    it('deve retornar 403 quando o todo for de outro usuário', async () => {
      const { token } = await createUserWithToken();
      const { user: otherUser } = await createUserWithToken();
      const todo = await createTodo({ user: otherUser._id });

      const res = await request(app)
        .delete(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'Você não tem permissão para excluir este todo.'
      );

      const stillThere = await Todo.findById(todo._id);
      expect(stillThere).toBeTruthy();
    });

    it('deve retornar 204 e excluir o todo quando for do usuário', async () => {
      const { user, token } = await createUserWithToken();
      const todo = await createTodo({ user: user._id });

      const res = await request(app)
        .delete(`/api/todos/${todo._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      const deleted = await Todo.findById(todo._id);
      expect(deleted).toBeNull();
    });
  });
});